export type ToolKind = "read" | "mutate";

export interface EvidenceHandle {
  kind: string;
  id?: string;
  url?: string;
  sha?: string;
  commitSha?: string;
  ticket_id?: string;
  [key: string]: unknown;
}

export interface StructuredConductError {
  code: string;
  message: string;
  currentState?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ConductPayload {
  evidence?: EvidenceHandle[];
  error?: StructuredConductError;
  errors?: StructuredConductError[];
  status?: string;
  state?: string;
  ticket_id?: string;
  jobId?: string;
  poll?: PollToolContract;
  origin_ticket_id?: string;
  depth?: number;
  [key: string]: unknown;
}

export interface McpLikeToolResult {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolClassifier {
  toolKind(toolName: string): ToolKind;
  isKnownTool(toolName: string): boolean;
}

export interface ToolClassifierInput {
  read?: readonly string[];
  mutate?: readonly string[];
}

export interface PollToolContract {
  name: string;
  inputField?: "ticket_id";
}

export interface LongToolAccepted {
  ticket_id: string;
  status: "accepted";
  origin_ticket_id?: string;
  depth?: number;
  poll?: PollToolContract;
}

export type CompletionState = "done" | "error";

export interface LongToolCompletion {
  ticket_id: string;
  state: CompletionState;
  evidence?: EvidenceHandle[];
  error?: StructuredConductError;
  origin_ticket_id?: string;
  depth?: number;
  [key: string]: unknown;
}

export interface LongToolContract {
  accepted: LongToolAccepted;
  completion: LongToolCompletion;
  poll: PollToolContract;
}

export interface DispatchContext {
  origin_ticket_id: string;
  depth: number;
}

export interface DispatchContextInput {
  ticket_id?: string;
  origin_ticket_id?: string;
  depth?: number;
}

export interface ConductCheckOptions {
  classifier?: ToolClassifier;
  kind?: ToolKind;
}

export interface LongToolConductOptions {
  /** Registered poll tool that resolves this ticket to a terminal completion. */
  pollTool: string;
  /** Guy-to-guy dispatches must propagate origin_ticket_id and increment depth. */
  dispatch?: boolean;
}

export interface ConductOptions {
  /** Unit-local declarations. Unknown names fail safe to mutate. */
  toolKinds?: ToolClassifierInput;
  /** Long-running tools and the poll tools that complete them. */
  longTools?: Readonly<Record<string, LongToolConductOptions>>;
}

export interface RegisteredToolConductProfile {
  kind: ToolKind;
  longTool?: LongToolConductOptions;
  pollFor?: readonly string[];
}

export class ConductContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConductContractError";
  }
}

function normalizeToolName(tool: string): string {
  return tool.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function createToolClassifier(input: ToolClassifierInput = {}): ToolClassifier {
  const kinds = new Map<string, ToolKind>();
  for (const tool of input.read ?? []) kinds.set(normalizeToolName(tool), "read");
  for (const tool of input.mutate ?? []) kinds.set(normalizeToolName(tool), "mutate");
  return {
    toolKind(toolName: string): ToolKind {
      return kinds.get(normalizeToolName(toolName)) ?? "mutate";
    },
    isKnownTool(toolName: string): boolean {
      return kinds.has(normalizeToolName(toolName));
    },
  };
}

export const DEFAULT_CONDUCT_CLASSIFIER = createToolClassifier({
  read: [
    "search_vault",
    "read_note",
    "list_pages",
    "search_memory",
    "get_memory",
    "get_recent_conversation_transcript",
    "execution_status",
    "ask_archus",
    "ask_zenod",
    "ask_phylax",
    "get_task_result",
    "get_council_result",
  ],
  mutate: [
    "create_issue",
    "open_issue",
    "edit_issue",
    "close_issue",
    "label_issue",
    "queue_execution",
    "approve_execution",
    "store_memory",
    "capture_note",
    "post_tweet",
    "post_reddit",
    "send_email",
    "dispatch_epaminon",
  ],
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePayload(result: ConductPayload | McpLikeToolResult): ConductPayload {
  const record = asRecord(result) ?? {};
  const structured = asRecord(record.structuredContent);
  return { ...record, ...(structured ?? {}) } as ConductPayload;
}

function hasStructuredError(payload: ConductPayload): boolean {
  const error = asRecord(payload.error);
  if (nonEmptyString(error?.code) && nonEmptyString(error?.message)) return true;
  return Array.isArray(payload.errors) && payload.errors.some((err) => nonEmptyString(err?.code) && nonEmptyString(err?.message));
}

export function isStructuredConductErrorResult(result: unknown): boolean {
  const record = asRecord(result);
  return record ? hasStructuredError(normalizePayload(record)) : false;
}

export function evidenceHasHandle(evidence: unknown): evidence is EvidenceHandle {
  const item = asRecord(evidence);
  if (!item || !nonEmptyString(item.kind)) return false;
  return (
    nonEmptyString(item.id) ||
    nonEmptyString(item.url) ||
    nonEmptyString(item.sha) ||
    nonEmptyString(item.commitSha) ||
    nonEmptyString(item.ticket_id)
  );
}

export function hasEvidenceHandle(payload: ConductPayload): boolean {
  return Array.isArray(payload.evidence) && payload.evidence.some(evidenceHasHandle);
}

function isAcceptedTicket(payload: ConductPayload): boolean {
  return nonEmptyString(payload.ticket_id) && (payload.status === "accepted" || payload.state === "accepted");
}

function conductPoll(value: unknown): PollToolContract | null {
  const poll = asRecord(value);
  if (!poll || !nonEmptyString(poll.name)) return null;
  if (poll.inputField !== undefined && poll.inputField !== "ticket_id") return null;
  return {
    name: poll.name,
    ...(poll.inputField === "ticket_id" ? { inputField: "ticket_id" as const } : {}),
  };
}

function optionalDispatchContext(payload: ConductPayload): void {
  const hasOrigin = payload.origin_ticket_id !== undefined;
  const hasDepth = payload.depth !== undefined;
  if (!hasOrigin && !hasDepth) return;
  if (!nonEmptyString(payload.origin_ticket_id)) {
    throw new ConductContractError(
      "missing_origin_ticket_id",
      "Dispatch context must carry a non-empty origin_ticket_id.",
    );
  }
  if (!hasDepth || typeof payload.depth !== "number") {
    throw new ConductContractError(
      "missing_dispatch_depth",
      "Dispatch context must carry depth together with origin_ticket_id.",
    );
  }
  assertDepth(payload.depth);
}

function configuredClassifier(options: ConductOptions): ToolClassifier | null {
  return options.toolKinds ? createToolClassifier(options.toolKinds) : null;
}

export function registeredToolConductProfile(
  toolName: string,
  readOnlyHint: boolean | undefined,
  options: ConductOptions = {},
): RegisteredToolConductProfile {
  const classifier = configuredClassifier(options);
  const configuredKind = classifier?.isKnownTool(toolName)
    ? classifier.toolKind(toolName)
    : null;
  const defaultKind = DEFAULT_CONDUCT_CLASSIFIER.isKnownTool(toolName)
    ? DEFAULT_CONDUCT_CLASSIFIER.toolKind(toolName)
    : null;
  const declaredKind = configuredKind ?? defaultKind;
  const annotatedKind =
    readOnlyHint === undefined ? null : readOnlyHint ? "read" : "mutate";
  if (declaredKind && annotatedKind && declaredKind !== annotatedKind) {
    throw new ConductContractError(
      "tool_kind_mismatch",
      `Tool "${toolName}" has conflicting conduct and readOnlyHint classifications.`,
    );
  }

  const normalized = normalizeToolName(toolName);
  let longTool: LongToolConductOptions | undefined;
  const pollFor: string[] = [];
  for (const [longToolName, declaration] of Object.entries(
    options.longTools ?? {},
  )) {
    if (normalizeToolName(longToolName) === normalized) longTool = declaration;
    if (normalizeToolName(declaration.pollTool) === normalized)
      pollFor.push(longToolName);
  }

  return {
    kind: declaredKind ?? "mutate",
    ...(longTool ? { longTool } : {}),
    ...(pollFor.length ? { pollFor } : {}),
  };
}

export function structuredError(code: string, message: string, currentState?: Record<string, unknown>): StructuredConductError {
  return { code, message, ...(currentState ? { currentState } : {}) };
}

export function evidence(kind: string, handle: Omit<EvidenceHandle, "kind">): EvidenceHandle {
  return { kind, ...handle };
}

export function assertConductResult<T extends ConductPayload | McpLikeToolResult>(
  toolName: string,
  result: T,
  options: ConductCheckOptions = {},
): T {
  const payload = normalizePayload(result);
  const kind = options.kind ?? options.classifier?.toolKind(toolName) ?? DEFAULT_CONDUCT_CLASSIFIER.toolKind(toolName);

  if (hasStructuredError(payload)) return result;
  if (isAcceptedTicket(payload)) return result;
  if (kind === "read") return result;
  if (hasEvidenceHandle(payload)) return result;

  throw new ConductContractError(
    "silent_ack",
    `Mutating tool "${toolName}" returned success without evidence[] or a structured error.`,
  );
}

export function withConduct<TInput, TResult extends ConductPayload | McpLikeToolResult>(
  toolName: string,
  handler: (input: TInput) => Promise<TResult> | TResult,
  options: ConductCheckOptions = {},
): (input: TInput) => Promise<TResult> {
  return async (input: TInput) => {
    const result = await handler(input);
    return assertConductResult(toolName, result, options);
  };
}

export function acceptedTicket(input: {
  ticket_id: string;
  origin_ticket_id?: string;
  depth?: number;
  poll?: PollToolContract;
}): LongToolAccepted {
  if (!nonEmptyString(input.ticket_id)) throw new ConductContractError("invalid_ticket", "Long tools must return a non-empty ticket_id.");
  optionalDispatchContext(input);
  if (input.poll && !conductPoll(input.poll)) {
    throw new ConductContractError(
      "missing_poll_tool",
      "Long tools must declare a valid poll tool.",
    );
  }
  return {
    ticket_id: input.ticket_id,
    status: "accepted",
    ...(input.origin_ticket_id ? { origin_ticket_id: input.origin_ticket_id } : {}),
    ...(input.depth !== undefined ? { depth: input.depth } : {}),
    ...(input.poll ? { poll: input.poll } : {}),
  };
}

export function completionEvent(input: LongToolCompletion): LongToolCompletion {
  if (!nonEmptyString(input.ticket_id)) throw new ConductContractError("invalid_ticket", "Completion events must carry the accepted ticket_id.");
  optionalDispatchContext(input);
  if (input.state === "done" && !hasEvidenceHandle(input)) {
    throw new ConductContractError("completion_without_evidence", "Done completion events must carry at least one evidence[] handle.");
  }
  if (input.state === "error" && !hasStructuredError(input)) {
    throw new ConductContractError("completion_without_error", "Error completion events must carry a structured error.");
  }
  return input;
}

function ticketIdFromInput(input: unknown): string | null {
  const record = asRecord(input);
  return nonEmptyString(record?.ticket_id) ? record.ticket_id : null;
}

function assertTicketMatchesInput(payload: ConductPayload, input: unknown): void {
  const requestedTicket = ticketIdFromInput(input);
  if (requestedTicket && payload.ticket_id !== requestedTicket) {
    throw new ConductContractError(
      "ticket_mismatch",
      "Poll result ticket_id must match the requested ticket_id.",
    );
  }
}

function assertDispatchPropagation(
  payload: ConductPayload,
  input: unknown,
): void {
  const parent = asRecord(input);
  const origin = parent?.origin_ticket_id ?? parent?.ticket_id;
  if (!nonEmptyString(origin)) {
    throw new ConductContractError(
      "missing_origin_ticket_id",
      "Dispatch tools require an upstream ticket_id or origin_ticket_id.",
    );
  }
  const parentDepth = parent?.depth ?? 0;
  if (typeof parentDepth !== "number") {
    throw new ConductContractError(
      "dispatch_depth_exceeded",
      "Dispatch depth must be an integer in the range 0..1.",
    );
  }
  assertDepth(parentDepth);
  const expected = propagateDispatchContext({
    origin_ticket_id: origin,
    depth: parentDepth,
  });
  if (payload.origin_ticket_id !== expected.origin_ticket_id) {
    throw new ConductContractError(
      "origin_ticket_mismatch",
      "Dispatch result must propagate the upstream origin_ticket_id unchanged.",
    );
  }
  if (payload.depth !== expected.depth) {
    throw new ConductContractError(
      "dispatch_depth_mismatch",
      `Dispatch result depth must be ${expected.depth}.`,
    );
  }
}

function assertLongToolAcceptedResult(
  toolName: string,
  payload: ConductPayload,
  input: unknown,
  declaration: LongToolConductOptions,
): void {
  if (!isAcceptedTicket(payload)) {
    throw new ConductContractError(
      "missing_accepted_ticket",
      `Long-running tool "${toolName}" must return status "accepted" and a non-empty ticket_id.`,
    );
  }
  const poll = conductPoll(payload.poll);
  if (!poll) {
    throw new ConductContractError(
      "missing_poll_tool",
      `Long-running tool "${toolName}" must return its poll tool contract.`,
    );
  }
  if (normalizeToolName(poll.name) !== normalizeToolName(declaration.pollTool)) {
    throw new ConductContractError(
      "poll_mismatch",
      `Long-running tool "${toolName}" must use poll tool "${declaration.pollTool}".`,
    );
  }
  optionalDispatchContext(payload);
  if (declaration.dispatch) assertDispatchPropagation(payload, input);
}

function assertPollResult(
  toolName: string,
  payload: ConductPayload,
  input: unknown,
): void {
  const state = payload.state ?? payload.status;
  if (state === "done" || state === "error") {
    if (!ticketIdFromInput(input)) {
      throw new ConductContractError(
        "invalid_ticket",
        `Poll tool "${toolName}" requires a non-empty ticket_id input.`,
      );
    }
    if (!nonEmptyString(payload.ticket_id)) {
      throw new ConductContractError(
        "invalid_ticket",
        `Poll tool "${toolName}" must return the requested ticket_id.`,
      );
    }
    assertTicketMatchesInput(payload, input);
    optionalDispatchContext(payload);
    completionEvent({
      ...payload,
      ticket_id: payload.ticket_id,
      state,
    });
    return;
  }
  if (hasStructuredError(payload)) return;
  if (!ticketIdFromInput(input)) {
    throw new ConductContractError(
      "invalid_ticket",
      `Poll tool "${toolName}" requires a non-empty ticket_id input.`,
    );
  }
  if (!nonEmptyString(payload.ticket_id)) {
    throw new ConductContractError(
      "invalid_ticket",
      `Poll tool "${toolName}" must return the requested ticket_id.`,
    );
  }
  assertTicketMatchesInput(payload, input);
  optionalDispatchContext(payload);

  if (state === "accepted" || state === "queued" || state === "pending" || state === "running") return;
  throw new ConductContractError(
    "invalid_completion_state",
    `Poll tool "${toolName}" must return an explicit pending or terminal state.`,
  );
}

export function assertRegisteredToolResult<
  T extends ConductPayload | McpLikeToolResult,
>(
  toolName: string,
  input: unknown,
  result: T,
  profile: RegisteredToolConductProfile,
): T {
  if (!asRecord(result)) {
    throw new ConductContractError(
      "invalid_tool_result",
      `Tool "${toolName}" must return an MCP result object.`,
    );
  }
  const payload = normalizePayload(result);
  if (payload.isError === true && !hasStructuredError(payload)) {
    throw new ConductContractError(
      "unstructured_error",
      `Tool "${toolName}" returned isError without a structured error code and message.`,
    );
  }
  if (profile.pollFor?.length) {
    assertPollResult(toolName, payload, input);
    return result;
  }
  if (hasStructuredError(payload)) return result;
  if (profile.longTool) {
    assertLongToolAcceptedResult(toolName, payload, input, profile.longTool);
    return result;
  }
  if (isAcceptedTicket(payload)) {
    throw new ConductContractError(
      "undeclared_long_tool",
      `Tool "${toolName}" returned an accepted ticket but is not declared in conduct.longTools.`,
    );
  }
  optionalDispatchContext(payload);
  return assertConductResult(toolName, result, { kind: profile.kind });
}

export function conductErrorResult(error: unknown): McpLikeToolResult & {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: { error: StructuredConductError };
  isError: true;
} {
  const contractError =
    error instanceof ConductContractError
      ? error
      : new ConductContractError(
          "tool_error",
          "Tool execution failed unexpectedly.",
        );
  const structured = structuredError(contractError.code, contractError.message);
  return {
    content: [
      { type: "text", text: `${structured.code}: ${structured.message}` },
    ],
    structuredContent: { error: structured },
    isError: true,
  };
}

export function assertLongToolContract(contract: LongToolContract): LongToolContract {
  acceptedTicket(contract.accepted);
  completionEvent(contract.completion);
  if (contract.accepted.ticket_id !== contract.completion.ticket_id) {
    throw new ConductContractError("ticket_mismatch", "Completion event ticket_id must match the accepted ticket_id.");
  }
  if (
    contract.accepted.origin_ticket_id !==
    contract.completion.origin_ticket_id
  ) {
    throw new ConductContractError(
      "origin_ticket_mismatch",
      "Completion event origin_ticket_id must match the accepted ticket.",
    );
  }
  if (contract.accepted.depth !== contract.completion.depth) {
    throw new ConductContractError(
      "dispatch_depth_mismatch",
      "Completion event depth must match the accepted ticket.",
    );
  }
  if (!nonEmptyString(contract.poll.name)) {
    throw new ConductContractError("missing_poll_tool", "Long tools must declare a poll tool.");
  }
  const acceptedPoll = contract.accepted.poll;
  if (acceptedPoll && acceptedPoll.name !== contract.poll.name) {
    throw new ConductContractError("poll_mismatch", "Accepted ticket poll tool must match the long-tool contract poll tool.");
  }
  return contract;
}

function assertDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 0 || depth > 1) {
    throw new ConductContractError("dispatch_depth_exceeded", "Dispatch depth must be an integer in the range 0..1.");
  }
}

export function rootDispatchContext(ticket_id: string): DispatchContext {
  if (!nonEmptyString(ticket_id)) throw new ConductContractError("missing_origin_ticket_id", "A root dispatch context needs a ticket_id.");
  return { origin_ticket_id: ticket_id, depth: 0 };
}

export function propagateDispatchContext(parent: DispatchContextInput): DispatchContext {
  const origin = parent.origin_ticket_id ?? parent.ticket_id;
  if (!nonEmptyString(origin)) {
    throw new ConductContractError("missing_origin_ticket_id", "Dispatches must propagate origin_ticket_id.");
  }
  const parentDepth = parent.depth ?? 0;
  assertDepth(parentDepth);
  const depth = parentDepth + 1;
  assertDepth(depth);
  return { origin_ticket_id: origin, depth };
}
